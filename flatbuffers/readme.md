# Schema & codegen for flatbuffer backed protocol

```bash
sudo pacman -Syu flatbuffers # on arch
brew install flatbuffers # on mac
./compile.sh
```

## UUID Notes
- Lesson learned: Flatbuffer won't compile definitions with fixed size arrays i.e. `[uint8:16]`.
