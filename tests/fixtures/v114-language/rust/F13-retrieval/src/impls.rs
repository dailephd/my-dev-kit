impl crate::alpha::Worker {
    pub fn run(&self) -> u8 { 1 }
}
impl crate::alpha::Runner for crate::alpha::Worker {
    fn run(&self) -> u8 {
        2
    }
}
