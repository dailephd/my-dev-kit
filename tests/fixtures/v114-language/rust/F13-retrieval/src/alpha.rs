pub struct Worker;
pub trait Runner {
    fn run(&self) -> u8;
}
pub fn work() -> u8 { 1 }
#[cfg(test)]
mod tests {
    use super::work;
    #[test]
    fn checks_work() { assert_eq!(work(), 1); }
}
