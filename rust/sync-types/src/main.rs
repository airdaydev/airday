use specta::{ts::*, *};

#[repr(u16)]
#[derive(Type)]
pub enum MyEnum {
    Ok = 254,
    NotOk = 255,
}

fn main() {
    println!(
        "{}",
        ts::export::<MyEnum>(&ExportConfiguration::new()).unwrap()
    );
}
