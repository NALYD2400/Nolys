//! Couche d'accès à Windows (Win32, COM, WinRT).
//!
//! Remplace l'ancien `liquid_core.exe` (.NET) et les appels PowerShell :
//! tout est appelé directement, sans processus externe.

pub mod audio;
pub mod com;
pub mod http;
pub mod icons;
pub mod mic_monitor;
pub mod process;
pub mod radios;
pub mod registry;
pub mod smtc;
pub mod system;
pub mod weather;
pub mod window;
