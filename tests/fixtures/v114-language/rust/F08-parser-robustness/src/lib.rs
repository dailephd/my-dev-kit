pub fn bounded() {
    let text = r###"{ not a block }"###;
    // } comment
    let nested = { { 1 } };
    println!("{{}}", text);
}
pub fn neighbor() {}
