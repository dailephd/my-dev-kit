const DETECTOR_ID: &str = "rust-detector";

#[test]
fn runs() {
    std::process::Command::new("npm").arg("run").arg("build").status().unwrap();
}
