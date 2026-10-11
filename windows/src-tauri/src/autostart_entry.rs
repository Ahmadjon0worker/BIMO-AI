//! Quote the Windows entry written by the current autostart plugin.
//!
//! Called only after an explicit enable succeeds. The plugin currently writes
//! `current_exe + " "` without quotes and with no arguments. Match those exact
//! REG_SZ bytes before replacing them, so customized or foreign values survive.

use std::{io, path::Path};
use winreg::{
    enums::{HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_BINARY},
    types::ToRegValue,
    RegKey, RegValue,
};

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const APPROVED_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
const PRODUCT: &str = "BIMO AI";
const LEGACY_NAMES: [&str; 2] = ["Qanot AI", "Coucou"];

fn read_optional(key: &RegKey, name: &str) -> io::Result<Option<RegValue>> {
    match key.get_raw_value(name) {
        Ok(value) => Ok(Some(value)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}
fn same_raw(a: &RegValue, b: &RegValue) -> bool { a.vtype == b.vtype && a.bytes == b.bytes }
fn owned_no_arguments(value: &RegValue, executable: &Path) -> bool {
    let path = executable.display().to_string();
    executable.is_absolute() && !path.contains(['"', '\0', '\r', '\n']) &&
        [path.clone(), format!("{path} "), format!("\"{path}\""), format!("\"{path}\" ")]
        .iter().any(|s| same_raw(value, &s.to_reg_value()))
}
fn open_optional(path: &str) -> io::Result<Option<RegKey>> {
    match RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(path, KEY_QUERY_VALUE | KEY_SET_VALUE) {
        Ok(key) => Ok(Some(key)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// Rename an existing own no-argument entry; never enable startup, decrypt user
/// state or touch another executable's command. MSI renames need this as well as
/// the NSIS migration hook. Task Manager's binary override stays byte-identical.
pub fn migrate_owned_legacy() -> io::Result<bool> {
    let Some(run) = open_optional(RUN_KEY)? else { return Ok(false) };
    let approved = open_optional(APPROVED_KEY)?;
    migrate_entries(&run, approved.as_ref(), &std::env::current_exe()?)
}

fn migrate_entries(run: &RegKey, approved: Option<&RegKey>, executable: &Path) -> io::Result<bool> {
    let current = read_optional(run, PRODUCT)?;
    if current.as_ref().is_some_and(|v| !owned_no_arguments(v, executable)) { return Ok(false); }
    let mut aliases = Vec::new();
    for name in LEGACY_NAMES {
        if let Some(value) = read_optional(run, name)? {
            if owned_no_arguments(&value, executable) { aliases.push((name, value)); }
        }
    }
    if aliases.is_empty() { return Ok(false); }
    if current.is_none() {
        // An orphaned new override still belongs to the user's new preference.
        if let Some(key) = approved {
            if read_optional(key, PRODUCT)?.is_some() { return Ok(false); }
        }
        let override_value = match approved {
            Some(key) => read_optional(key, aliases[0].0)?, None => None,
        };
        if override_value.as_ref().is_some_and(|v| v.vtype != REG_BINARY || v.bytes.is_empty() || v.bytes.len() > 4096) { return Ok(false); }
        if let (Some(key), Some(value)) = (approved, override_value.as_ref()) { key.set_raw_value(PRODUCT, value)?; }
        let new_value = format!("\"{}\"", executable.display()).to_reg_value();
        if let Err(error) = run.set_raw_value(PRODUCT, &new_value) {
            // Roll back only the exact override this invocation just copied.
            if let (Some(key), Some(value)) = (approved, override_value.as_ref()) {
                if read_optional(key, PRODUCT)?.as_ref().is_some_and(|v| same_raw(v, value)) { key.delete_value(PRODUCT)?; }
            }
            return Err(error);
        }
    }
    // Recheck after creating the new entry; never remove an alias if another
    // app/user changed it or changed the replacement's command during migration.
    if !read_optional(run, PRODUCT)?.as_ref().is_some_and(|v| owned_no_arguments(v, executable)) { return Ok(false); }
    let mut changed = false;
    for (name, original) in aliases {
        if read_optional(run, name)?.as_ref().is_some_and(|v| same_raw(v, &original)) {
            run.delete_value(name)?;
            if let Some(key) = approved { match key.delete_value(name) {
                Ok(()) => {}, Err(e) if e.kind() == io::ErrorKind::NotFound => {}, Err(e) => return Err(e),
            } }
            changed = true;
        }
    }
    Ok(changed)
}

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
    use super::{normalize_entry, migrate_entries};
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

    const FIXTURE_PARENT: &str = r"Software\BimoAITests";
    const EXE: &str = r"C:\Users\Sinov Пользователь\AppData\Local\Coucou\coucou.exe";
    const ENTRY: &str = "BIMO AI";

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

    #[test]
    fn migrates_both_owned_aliases_and_preserves_disabled_override_bytes() {
        let run = Fixture::new(); let approved = Fixture::new();
        let disabled = RegValue { vtype: REG_BINARY, bytes: vec![3,0,0,0,1,2,3,4,5,6,7,8] };
        for name in ["Qanot AI", "Coucou"] {
            run.key().set_value(name, &format!("{EXE} ")).unwrap();
            approved.key().set_raw_value(name, &disabled).unwrap();
        }
        assert!(migrate_entries(run.key(), Some(approved.key()), Path::new(EXE)).unwrap());
        assert_eq!(run.key().get_value::<String, _>(ENTRY).unwrap(), format!("\"{EXE}\""));
        assert_raw(approved.key(), ENTRY, &disabled);
        for name in ["Qanot AI", "Coucou"] { assert!(run.key().get_raw_value(name).is_err()); assert!(approved.key().get_raw_value(name).is_err()); }
        assert!(!migrate_entries(run.key(), Some(approved.key()), Path::new(EXE)).unwrap());
    }
    #[test]
    fn migration_preserves_foreign_typed_new_entries_and_orphaned_override() {
        for value in ["custom-command".to_reg_value(), "".to_reg_value(), RegValue { vtype: REG_BINARY, bytes: vec![0,1,2] }] {
            let run = Fixture::new(); let approved = Fixture::new();
            let old = format!("{EXE} ").to_reg_value(); run.key().set_raw_value("Qanot AI", &old).unwrap();
            run.key().set_raw_value(ENTRY, &value).unwrap();
            assert!(!migrate_entries(run.key(), Some(approved.key()), Path::new(EXE)).unwrap());
            assert_raw(run.key(), ENTRY, &value); assert_raw(run.key(), "Qanot AI", &old);
        }
        let run = Fixture::new(); let approved = Fixture::new();
        let old = format!("{EXE} ").to_reg_value(); run.key().set_raw_value("Coucou", &old).unwrap();
        let override_value = RegValue { vtype: REG_BINARY, bytes: vec![2,0,0,0] };
        approved.key().set_raw_value(ENTRY, &override_value).unwrap();
        assert!(!migrate_entries(run.key(), Some(approved.key()), Path::new(EXE)).unwrap());
        assert_raw(approved.key(), ENTRY, &override_value); assert_raw(run.key(), "Coucou", &old);
    }
    #[test]
    fn migration_never_enables_startup_or_changes_other_executables_or_arguments() {
        let run = Fixture::new();
        assert!(!migrate_entries(run.key(), None, Path::new(EXE)).unwrap());
        for command in [format!("\"{EXE}\" --studio"), r"C:\Other\coucou.exe ".into()] {
            let original = command.to_reg_value(); run.key().set_raw_value("Qanot AI", &original).unwrap();
            assert!(!migrate_entries(run.key(), None, Path::new(EXE)).unwrap()); assert_raw(run.key(), "Qanot AI", &original);
        }
    }
    #[test]
    fn existing_owned_bimo_command_removes_only_exact_owned_duplicates() {
        let run = Fixture::new(); let approved = Fixture::new();
        let own = format!("\"{EXE}\"").to_reg_value(); let foreign = r"C:\Other\coucou.exe ".to_reg_value();
        run.key().set_raw_value(ENTRY, &own).unwrap(); run.key().set_raw_value("Qanot AI", &own).unwrap(); run.key().set_raw_value("Coucou", &foreign).unwrap();
        let disabled = RegValue { vtype: REG_BINARY, bytes: vec![3,0,0,0] }; approved.key().set_raw_value(ENTRY, &disabled).unwrap();
        assert!(migrate_entries(run.key(), Some(approved.key()), Path::new(EXE)).unwrap());
        assert_raw(run.key(), ENTRY, &own); assert_raw(approved.key(), ENTRY, &disabled); assert_raw(run.key(), "Coucou", &foreign);
        assert!(run.key().get_raw_value("Qanot AI").is_err());
    }
}
