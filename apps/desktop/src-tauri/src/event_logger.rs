#[cfg(target_os = "windows")]
use windows::core::PCWSTR;
#[cfg(target_os = "windows")]
use windows::Win32::Security::PSID;
#[cfg(target_os = "windows")]
use windows::Win32::System::EventLog::{
    DeregisterEventSource, RegisterEventSourceW, ReportEventW, EVENTLOG_ERROR_TYPE,
    EVENTLOG_INFORMATION_TYPE, EVENTLOG_WARNING_TYPE,
};

#[allow(dead_code)]
pub enum LogLevel {
    Info,
    Warning,
    Error,
}

/// Logs application activity directly into Windows Event Viewer (Application Log -> Source: NexusEcho).
#[allow(unused_variables)]
pub fn log_event(event_id: u32, level: LogLevel, message: &str) {
    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;

        let source_name: Vec<u16> = OsStr::new("NexusEcho")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let msg_wide: Vec<u16> = OsStr::new(message)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        unsafe {
            if let Ok(handle) = RegisterEventSourceW(PCWSTR::null(), PCWSTR(source_name.as_ptr())) {
                if !handle.is_invalid() {
                    let event_type = match level {
                        LogLevel::Info => EVENTLOG_INFORMATION_TYPE,
                        LogLevel::Warning => EVENTLOG_WARNING_TYPE,
                        LogLevel::Error => EVENTLOG_ERROR_TYPE,
                    };

                    let strings = [PCWSTR(msg_wide.as_ptr())];
                    let _ = ReportEventW(
                        handle,
                        event_type,
                        0,
                        event_id,
                        PSID::default(),
                        0,
                        None,
                        Some(strings.as_ptr() as *const _),
                    );
                    let _ = DeregisterEventSource(handle);
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let prefix = match level {
            LogLevel::Info => "[INFO]",
            LogLevel::Warning => "[WARN]",
            LogLevel::Error => "[ERROR]",
        };
        println!("{} [NexusEcho Event {}] {}", prefix, event_id, message);
    }
}
