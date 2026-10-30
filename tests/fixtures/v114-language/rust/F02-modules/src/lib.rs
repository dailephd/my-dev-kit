pub mod foo;
mod baz;
#[path = "path_overridden.rs"]
mod custom;
mod outer {
    pub mod inner { pub fn run() {} }
}
