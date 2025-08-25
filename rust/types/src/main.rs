use specta::{ts::*, *};

#[derive(Type)]
pub struct MyCustomType {
    pub my_field: String,
}

fn main() {
    assert_eq!(
        ts::export::<MyCustomType>(&ExportConfiguration::default()).unwrap(),
        "export type MyCustomType = { my_field: string }".to_string()
    );
}
