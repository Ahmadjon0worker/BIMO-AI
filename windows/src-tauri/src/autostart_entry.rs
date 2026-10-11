//! Quote the Windows entry written by the current autostart plugin.
//!
//! Called only after an explicit enable succeeds. The plugin currently writes
//! `current_exe + " "` without quotes and with no arguments. Match those exact
//! REG_SZ bytes before replacing them, so customized or foreign values survive.

use std::{io, path::Path};
use winreg::{
    enums::{HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE},
    types::ToRegValue,
    RegKey,
};

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

/// Do not create a registry key or entry, change an autostart preference, or
/// touch StartupApproved. Only normalize the plugin's just-enabled own value.
pub fn normalize_enabled(app_name: &str) -> io::Result<bool> {
    let executable = std::env::current_exe()?;
    let key = match RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(RUN_KEY, KEY_QUERY_VALUE | KEY_SET_VALUE)
    {
        Ok(key) => key,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    };
    normalize_entry(&key, app_name, &executable)
}

fn normalize_entry(key: &RegKey, app_name: &str, executable: &Path) -> io::Result<bool> {
    // Use the same display representation as tauri-plugin-autostart 2.6.0.
    let path = executable.display().to_string();
    if !executable.is_absolute() || path.contains(['"', '\0', '\r', '\n']) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid autostart executable path",
        ));
    }
    let expected = format!("{path} ").to_reg_value();
    let current = match key.get_raw_value(app_name) {
        Ok(value) => value,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    };
    if current.vtype != expected.vtype || current.bytes != expected.bytes {
        return Ok(false);
    }
    let quoted = format!("\"{path}\"").to_reg_value();
    key.set_raw_value(app_name, &quoted)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::normalize_entry;
    use std::{
        path::Path,
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };
    use winreg::{
        enums::{
            HKEY_CURRENT_USER, REG_BINARY, REG_CREATED_NEW_KEY, REG_DWORD, REG_EXPAND_SZ,
            REG_MULTI_SZ,
        },
        types::ToRegValue,
        RegKey, RegValue,
    };

    const FIXTURE_PARENT: &str = r"Software\QanotAITests";
    const EXE: &str = r"C:\Users\Sinov Пользователь\AppData\Local\Qanot AI\coucou.exe";
    const ENTRY: &str = "Qanot AI";

    /// All tests use an inert unique leaf, never Run or StartupApproved.
    struct Fixture {
        key: Option<RegKey>,
        path: String,
    }

    impl Fixture {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = format!(
                r"{}\autostart-{}-{}-{}",
                FIXTURE_PARENT,
                std::process::id(),
                stamp,
                NEXT.fetch_add(1, Ordering::Relaxed)
            );
            let (key, disposition) = RegKey::predef(HKEY_CURRENT_USER)
                .create_subkey(&path)
                .unwrap();
            assert_eq!(
                disposition, REG_CREATED_NEW_KEY,
                "Test fixture must be newly created"
            );
            Self {
                key: Some(key),
                path,
            }
        }

        fn key(&self) -> &RegKey {
            self.key.as_ref().unwrap()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            // Close the handle and delete only this fixture's leaf. Never
            // recursively delete the shared fixture parent or another key.
            self.key.take();
            assert!(self
                .path
                .starts_with(&format!(r"{}\autostart-", FIXTURE_PARENT)));
            assert!(!self.path[FIXTURE_PARENT.len() + 1..].contains('\\'));
            let cleanup = RegKey::predef(HKEY_CURRENT_USER).delete_subkey(&self.path);
            if !std::thread::panicking() {
                cleanup.expect("Remove only this test fixture");
            }
        }
    }

    fn assert_raw(key: &RegKey, name: &str, expected: &RegValue) {
        let actual = key.get_raw_value(name).unwrap();
        assert_eq!(actual.vtype, expected.vtype);
        assert_eq!(actual.bytes, expected.bytes);
    }

    #[test]
    fn quotes_the_enabled_executable_with_spaces_and_unicode() {
        let fixture = Fixture::new();
        let key = fixture.key();
        key.set_value(ENTRY, &format!("{EXE} ")).unwrap();
        assert!(normalize_entry(key, ENTRY, Path::new(EXE)).unwrap());
        assert_eq!(
            key.get_value::<String, _>(ENTRY).unwrap(),
            format!("\"{EXE}\"")
        );
    }

    #[test]
    fn preserves_foreign_commands_and_neighboring_entries() {
        let fixture = Fixture::new();
        let key = fixture.key();
        let neighbor = r#""C:\Other App\tool.exe" --keep"#.to_reg_value();
        key.set_raw_value("Unrelated application", &neighbor)
            .unwrap();
        for command in [
            r"C:\Other App\coucou.exe ".to_owned(),
            format!("{EXE} --studio"),
            format!("{EXE}  "),
            EXE.to_owned(),
        ] {
            let original = command.to_reg_value();
            key.set_raw_value(ENTRY, &original).unwrap();
            assert!(!normalize_entry(key, ENTRY, Path::new(EXE)).unwrap());
            assert_raw(key, ENTRY, &original);
            assert_raw(key, "Unrelated application", &neighbor);
        }
    }

    #[test]
    fn preserves_different_registry_types_even_with_matching_string_bytes() {
        let fixture = Fixture::new();
        let key = fixture.key();
        for kind in [REG_EXPAND_SZ, REG_MULTI_SZ, REG_BINARY, REG_DWORD] {
            let mut original = format!("{EXE} ").to_reg_value();
            if kind == REG_DWORD {
                original.bytes = 0xaabbccdd_u32.to_le_bytes().to_vec();
            }
            original.vtype = kind;
            key.set_raw_value(ENTRY, &original).unwrap();
            assert!(!normalize_entry(key, ENTRY, Path::new(EXE)).unwrap());
            assert_raw(key, ENTRY, &original);
        }
    }

    #[test]
    fn missing_and_already_quoted_entries_are_no_ops() {
        let fixture = Fixture::new();
        let key = fixture.key();
        assert!(!normalize_entry(key, ENTRY, Path::new(EXE)).unwrap());
        assert_eq!(
            key.get_raw_value(ENTRY).unwrap_err().kind(),
            std::io::ErrorKind::NotFound
        );
        let original = format!("\"{EXE}\"").to_reg_value();
        key.set_raw_value(ENTRY, &original).unwrap();
        assert!(!normalize_entry(key, ENTRY, Path::new(EXE)).unwrap());
        assert_raw(key, ENTRY, &original);
    }

    #[test]
    fn preserves_changed_raw_string_encoding() {
        let fixture = Fixture::new();
        let key = fixture.key();
        let expected = format!("{EXE} ").to_reg_value();
        for extra in [vec![0, 0], vec![1], vec![0, 216]] {
            let mut original = RegValue {
                bytes: expected.bytes.clone(),
                vtype: expected.vtype.clone(),
            };
            original.bytes.extend(extra);
            key.set_raw_value(ENTRY, &original).unwrap();
            assert!(!normalize_entry(key, ENTRY, Path::new(EXE)).unwrap());
            assert_raw(key, ENTRY, &original);
        }
    }

    #[test]
    fn rejects_an_invalid_executable_without_changing_the_entry() {
        let fixture = Fixture::new();
        let key = fixture.key();
        let original = format!("{EXE} ").to_reg_value();
        key.set_raw_value(ENTRY, &original).unwrap();
        for invalid in [
            r"relative\coucou.exe",
            "C:\\bad\"path\\coucou.exe",
            "C:\\bad\npath\\coucou.exe",
        ] {
            assert_eq!(
                normalize_entry(key, ENTRY, Path::new(invalid))
                    .unwrap_err()
                    .kind(),
                std::io::ErrorKind::InvalidInput
            );
            assert_raw(key, ENTRY, &original);
        }
    }
}
