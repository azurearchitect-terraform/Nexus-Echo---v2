use std::collections::HashSet;
use std::time::Duration;
use reqwest::{Client, Url};
use regex::Regex;

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
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let mut url_to_parse = url_str.trim().to_string();
    if !url_to_parse.starts_with("http://") && !url_to_parse.starts_with("https://") {
        url_to_parse = format!("https://{}", url_to_parse);
    }

    let parsed_url = Url::parse(&url_to_parse).map_err(|e| format!("Invalid URL: {e}"))?;
    let base_domain = parsed_url.domain().ok_or("No domain found in URL")?.to_string();

    // 1. Fetch main page HTML
    let main_response = client.get(parsed_url.clone())
        .send()
        .await
        .map_err(|e| format!("Failed to fetch main page: {e}"))?;
    
    let main_html = main_response.text()
        .await
        .map_err(|e| format!("Failed to get HTML content: {e}"))?;

    let mut crawled_texts = vec![format!("=== Main Page ({}) ===\n{}", url_str, clean_html(&main_html))];
    let mut discovered_urls = HashSet::new();

    // 2. Extract links containing relevant keywords
    let re_href = Regex::new(r#"(?i)href=["']([^"']+)["']"#).unwrap();
    let filter_keywords = ["about", "career", "culture", "job", "value", "mission", "team"];

    for cap in re_href.captures_iter(&main_html) {
        let path = &cap[1];
        
        // Attempt to parse or resolve relative path
        if let Ok(resolved_url) = parsed_url.join(path) {
            // Ensure we stay in the same domain and don't re-crawl the main page
            if let Some(domain) = resolved_url.domain() {
                if domain.ends_with(&base_domain) && resolved_url.path() != "/" && resolved_url.path() != "" {
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
        match client.get(sub_url.clone()).send().await {
            Ok(res) => {
                if let Ok(html) = res.text().await {
                    let cleaned = clean_html(&html);
                    crawled_texts.push(format!("\n\n=== Page ({}) ===\n{}", sub_url.as_str(), cleaned));
                }
            }
            Err(e) => {
                tracing::warn!("Failed to fetch subpage {}: {}", sub_url, e);
            }
        }
    }

    Ok(crawled_texts.join("\n"))
}
