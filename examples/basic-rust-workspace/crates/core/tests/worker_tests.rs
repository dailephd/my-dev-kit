use basic_rust_core::{Runner, Worker};

#[test]
fn worker_runs_by_doubling_its_id() {
    assert_eq!(Worker::new(2).run(), 4);
}
