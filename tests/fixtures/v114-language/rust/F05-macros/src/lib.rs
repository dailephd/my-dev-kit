#[derive(Debug)]
pub struct Example;
#[cfg(test)]
mod tests {
    #[test]
    fn works() { assert!(true); }
}
#[cfg_attr(feature = "custom", custom::decorate)]
#[custom::observe]
pub fn decorated() {}
macro_rules! generate { () => { fn generated_only_by_expansion() {} } }
generate!();
