# Schema & codegen for flatbuffer backed protocol

```bash
sudo pacman -Syu flatbuffers # on arch
brew install flatbuffers # on mac
./compile.sh
```

## UUID Notes
- Flatbuffer won't compile definitions with fixed size arrays i.e. `[uint8:16]`, but I'm migrating to a Rust core from Swift
