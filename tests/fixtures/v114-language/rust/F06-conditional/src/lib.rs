#[cfg(feature = "extra")]
mod extra;
#[cfg_attr(feature = "extra", path = "extra.rs")]
mod fallback;
macro_rules! generate { () => { mod invented; } }
generate!();
