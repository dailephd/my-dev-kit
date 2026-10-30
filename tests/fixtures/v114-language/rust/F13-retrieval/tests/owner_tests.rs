#[path = "../src/alpha.rs"]
mod alpha;
#[path = "../src/impls.rs"]
mod impls;
use crate::alpha::{Runner, Worker};
#[test]
fn runner_implementation() {
    assert_eq!(Runner::run(&Worker), 2);
}
