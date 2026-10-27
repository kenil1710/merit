fn main() {
    println!("cargo:rerun-if-changed=../src/lib.rs");
    println!("cargo:rerun-if-changed=../Cargo.toml");
    rialo_build_lib::build_script::setup_polkavm_artifact_build()
        .program_path("..")
        .run()
        .expect("failed to build the merit-hello PolkaVM artifact");
    rialo_venus_build_helper::compile_rex_components("..")
        .expect("failed to build the merit-hello REX WASM components");
}
