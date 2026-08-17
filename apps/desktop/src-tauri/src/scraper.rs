use std::collections::HashSet;
use std::net::IpAddr;
use std::time::Duration;
use reqwest::{header::LOCATION, redirect::Policy, Client, Url};
use regex::Regex;

const MAX_RESPONSE_BYTES: usize = 5 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;

fn normalized_host(url: &Url) -> Result<String, String> {
    let host = url.host_str().ok_or("URL must include a host")?;
    Ok(host.trim_start_matches("www.").to_ascii_lowercase())
}

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, ..] = ip.octets();
            !(a == 0
                || a == 10
                || a == 127
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && b == 168)
                || (a == 198 && (b == 18 || b == 19))
                || a >= 224)
        }
        IpAddr::V6(ip) => {
            if let Some(mapped) = ip.to_ipv4_mapped() {
                return is_public_ip(IpAddr::V4(mapped));
            }
            !(ip.is_unspecified()
                || ip.is_loopback()
                || ip.is_multicast()
                || ip.is_unique_local()
                || ip.is_unicast_link_local())
        }
    }
}

async fn validate_public_url(url: &Url, expected_host: &str) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err("only HTTP and HTTPS URLs are supported".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("URLs containing credentials are not allowed".into());
    }
    if normalized_host(url)? != expected_host {
        return Err("redirect or link left the requested company host".into());
    }

    let host = url.host_str().ok_or("URL must include a host")?;
    let port = url.port_or_known_default().ok_or("URL has no usable port")?;
    let addresses: Vec<_> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|e| format!("failed to resolve host: {e}"))?
        .collect();
    if addresses.is_empty() || addresses.iter().any(|address| !is_public_ip(address.ip())) {
        return Err("local, private, and special-purpose network targets are not allowed".into());
    }
    Ok(())
}

async fn fetch_html(client: &Client, initial_url: Url, expected_host: &str) -> Result<(Url, String), String> {
    let mut url = initial_url;
    for redirect_count in 0..=MAX_REDIRECTS {
        validate_public_url(&url, expected_host).await?;
        let mut response = client
            .get(url.clone())
            .send()
            .await
            .map_err(|e| format!("failed to fetch {url}: {e}"))?;

        if response.status().is_redirection() {
            if redirect_count == MAX_REDIRECTS {
                return Err("too many redirects".into());
            }
            let location = response
                .headers()
                .get(LOCATION)
                .ok_or("redirect response did not include a location")?
                .to_str()
                .map_err(|_| "redirect location was not valid text")?;
            url = url.join(location).map_err(|e| format!("invalid redirect URL: {e}"))?;
            continue;
        }

        if !response.status().is_success() {
            return Err(format!("website returned HTTP {}", response.status()));
        }
        if response.content_length().is_some_and(|length| length > MAX_RESPONSE_BYTES as u64) {
            return Err("website response exceeds the 5 MB limit".into());
        }

        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|e| format!("failed to read response: {e}"))? {
            if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
                return Err("website response exceeds the 5 MB limit".into());
            }
            body.extend_from_slice(&chunk);
        }
        let html = String::from_utf8_lossy(&body).into_owned();
        return Ok((url, html));
    }
    Err("too many redirects".into())
}

/// Strips HTML tags, script/style tags, and returns normalized plain text.
fn clean_html(html: &str) -> String {
    // 1. Remove comments
    let re_comments = Regex::new(r"(?s)<!--.*?-->").unwrap();
    let html = re_comments.replace_all(html, "");

    // 2. Remove script/style tags and their contents
    let re_scripts = Regex::new(r"(?is)<script[^>]*>.*?</script>").unwrap();
    let html = re_scripts.replace_all(&html, "");

    let re_styles = Regex::new(r"(?is)<style[^>]*>.*?</style>").unwrap();
    let html = re_styles.replace_all(&html, "");

    // 3. Remove all other HTML tags
    let re_tags = Regex::new(r"<[^>]*>").unwrap();
    let text = re_tags.replace_all(&html, " ");

    // 4. Decode basic HTML entities
    let text = text
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">");

    // 5. Clean up duplicate spaces and newlines
    let re_whitespace = Regex::new(r"\s+").unwrap();
    let text = re_whitespace.replace_all(&text, " ");

    text.trim().to_string()
}

pub async fn scrape_company_website(url_str: &str) -> Result<String, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(Policy::none())
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let mut url_to_parse = url_str.trim().to_string();
    if !url_to_parse.starts_with("http://") && !url_to_parse.starts_with("https://") {
        url_to_parse = format!("https://{}", url_to_parse);
    }

    let parsed_url = Url::parse(&url_to_parse).map_err(|e| format!("Invalid URL: {e}"))?;
    let base_host = normalized_host(&parsed_url)?;

    // 1. Fetch main page HTML
    let (main_url, main_html) = fetch_html(&client, parsed_url, &base_host).await?;

    let mut crawled_texts = vec![format!("=== Main Page ({}) ===\n{}", url_str, clean_html(&main_html))];
    let mut discovered_urls = HashSet::new();

    // 2. Extract links containing relevant keywords
    let re_href = Regex::new(r#"(?i)href=["']([^"']+)["']"#).unwrap();
    let filter_keywords = ["about", "career", "culture", "job", "value", "mission", "team"];

    for cap in re_href.captures_iter(&main_html) {
        let path = &cap[1];
        
        // Attempt to parse or resolve relative path
        if let Ok(resolved_url) = main_url.join(path) {
            // Ensure we stay in the same domain and don't re-crawl the main page
            if normalized_host(&resolved_url).is_ok_and(|host| host == base_host) {
                if resolved_url.path() != "/" && resolved_url.path() != "" {
                    // Check if it matches any keyword
                    let lower_path = resolved_url.path().to_lowercase();
                    if filter_keywords.iter().any(|&kw| lower_path.contains(kw)) {
                        discovered_urls.insert(resolved_url);
                    }
                }
            }
        }
    }

    // Limit to top 3 subpages to avoid spamming the site and rate limits
    let urls_list: Vec<Url> = discovered_urls.into_iter().take(3).collect();
    
    // 3. Fetch subpages
    for sub_url in urls_list {
        match fetch_html(&client, sub_url.clone(), &base_host).await {
            Ok((final_url, html)) => {
                let cleaned = clean_html(&html);
                crawled_texts.push(format!("\n\n=== Page ({}) ===\n{}", final_url.as_str(), cleaned));
            }
            Err(e) => {
                tracing::warn!("Failed to fetch subpage {}: {}", sub_url, e);
            }
        }
    }

    Ok(crawled_texts.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::{is_public_ip, normalized_host};
    use reqwest::Url;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    #[test]
    fn rejects_private_and_special_networks() {
        let blocked = [
            Ipv4Addr::new(127, 0, 0, 1),
            Ipv4Addr::new(10, 0, 0, 1),
            Ipv4Addr::new(100, 64, 0, 1),
            Ipv4Addr::new(169, 254, 169, 254),
            Ipv4Addr::new(172, 16, 0, 1),
            Ipv4Addr::new(192, 168, 0, 1),
            Ipv4Addr::new(198, 18, 0, 1),
        ];
        for ip in blocked {
            assert!(!is_public_ip(IpAddr::V4(ip)), "{ip} must be blocked");
        }
        assert!(!is_public_ip(IpAddr::V6(Ipv6Addr::LOCALHOST)));
        assert!(is_public_ip(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))));
    }

    #[test]
    fn normalizes_only_the_www_host_prefix() {
        let www = Url::parse("https://www.example.com/about").unwrap();
        let subdomain = Url::parse("https://careers.example.com/").unwrap();
        assert_eq!(normalized_host(&www).unwrap(), "example.com");
        assert_eq!(normalized_host(&subdomain).unwrap(), "careers.example.com");
    }
}
