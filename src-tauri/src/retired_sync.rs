//! Cleanup for retired device sync (MUT-73, ADR-053).
//!
//! The LAN sync server kept one thing on disk: the paired-devices file in the
//! app config directory, holding the bearer tokens this desktop issued to
//! paired phones, plus the temp file its atomic writes went through. With the
//! server gone those tokens authenticate to nothing, but they are still
//! credentials left on disk, so every launch removes them.
//!
//! Best effort by design. A file that is not there is the normal case and
//! counts as success. Any other failure is returned for the caller to log; it
//! never stops the app from starting, and the next launch tries again. Only
//! these two files are touched — never the directory, never anything else in it.

use std::io;
use std::path::{Path, PathBuf};

/// The files the retired sync module wrote to the app config directory.
pub const RETIRED_FILES: [&str; 2] = ["paired_devices.json", "paired_devices.tmp"];

/// Remove the retired sync files from `config_dir`. Returns the files that
/// exist but could not be removed, with the reason; an empty list is success.
pub fn remove_retired_sync_files(config_dir: &Path) -> Vec<(PathBuf, io::Error)> {
    RETIRED_FILES
        .iter()
        .map(|name| config_dir.join(name))
        .filter_map(|path| match std::fs::remove_file(&path) {
            Ok(()) => None,
            Err(err) if err.kind() == io::ErrorKind::NotFound => None,
            Err(err) => Some((path, err)),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn removes_the_paired_devices_file_and_its_temp_file() {
        let dir = tempdir().unwrap();
        for name in RETIRED_FILES {
            fs::write(dir.path().join(name), "{\"devices\":[{\"token\":\"secret\"}]}").unwrap();
        }

        let failures = remove_retired_sync_files(dir.path());

        assert!(failures.is_empty());
        for name in RETIRED_FILES {
            assert!(!dir.path().join(name).exists(), "{name} should be gone");
        }
    }

    #[test]
    fn missing_files_are_success() {
        let dir = tempdir().unwrap();

        assert!(remove_retired_sync_files(dir.path()).is_empty());
    }

    #[test]
    fn leaves_every_other_file_and_the_directory_alone() {
        let dir = tempdir().unwrap();
        let other = dir.path().join("settings.json");
        fs::write(&other, "{}").unwrap();
        fs::write(dir.path().join("paired_devices.json"), "{}").unwrap();

        remove_retired_sync_files(dir.path());

        assert!(dir.path().is_dir());
        assert_eq!(fs::read_to_string(&other).unwrap(), "{}");
    }

    #[test]
    fn reports_a_file_it_cannot_remove_instead_of_panicking() {
        let dir = tempdir().unwrap();
        // remove_file refuses a directory, which stands in for any I/O failure.
        fs::create_dir(dir.path().join("paired_devices.json")).unwrap();

        let failures = remove_retired_sync_files(dir.path());

        assert_eq!(failures.len(), 1);
        assert_eq!(failures[0].0, dir.path().join("paired_devices.json"));
    }

    #[test]
    fn a_missing_config_directory_is_success() {
        let dir = tempdir().unwrap();

        assert!(remove_retired_sync_files(&dir.path().join("never-created")).is_empty());
    }
}
