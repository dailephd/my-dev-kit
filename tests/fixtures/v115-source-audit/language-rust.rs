use std::collections::{HashMap, HashSet};
use crate::inner::Helper as Aliased;
pub use self::inner::Exposed;

pub mod inner {
    pub struct Exposed;
    pub(crate) fn crate_visible() {}
    fn private_fn() {}
}

pub struct Config {
    pub name: String,
    secret: u32,
}

pub enum Mode {
    Fast,
    Slow,
}

pub trait Runner {
    fn run(&self);
}

impl Runner for Config {
    fn run(&self) {}
}

impl Config {
    pub fn new() -> Self {
        Config { name: String::new(), secret: 0 }
    }
    fn hidden(&self) {}
}
