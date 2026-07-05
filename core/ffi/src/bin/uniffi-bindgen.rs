//! uniffi's standard bindgen entry point. Invoked in library mode by
//! `apple/build-xcframework.sh` to generate the Swift bindings from the
//! host cdylib's embedded metadata.
fn main() {
    uniffi::uniffi_bindgen_main()
}
