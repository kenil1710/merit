// Splices each policy body into the function Latch's editor wraps it in: the live policy and the outcall one.
fn main() {
    let out = std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("policy.rs");
    let mut code = String::new();
    for (module, src) in [("live", "../merit-x-submissions.rs"), ("outcall", "../merit-x-submissions-outcall.rs")] {
        println!("cargo:rerun-if-changed={src}");
        let body = std::fs::read_to_string(src).expect("policy source");
        code += &format!("pub mod {module} {{\n#[allow(unused_imports)]\nuse super::*;\npub fn on_request(ctx: &RequestContext) -> PolicyResult {{\n{body}\n}}\n}}\n");
    }
    std::fs::write(out, code).unwrap();
}
