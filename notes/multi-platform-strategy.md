# Multi-platform cal/tasks app strategy

Simplest PWA Prototype:
1. Pull CalDAV events from foreign calendar into local persistent storage & display, create events via this means too
2. Automerge tasks into local persistent storage & display
3. Determine data store for tasks
4. Build CalDAV server too


These are the platforms I care about in the the order I care about them, most care first:

1. Web
2. iOS
3. Linux
4. MacOS
5. Android
6. Windows

There are 4 major dependencies for the client:
1. iCal
2. WebDav
3. VCard
4. WebGPU/Similar (Calendar renderer)
5. Automerge (Tasks, encrypted calendar attachments)
6. Native UI

## Alternatives
- JMAP
- Jcal, Jcard

## Caldav
I can choose from:
- https://github.com/natelindev/tsdav (typescript)
- libical (c) + CalDav
- kcaldav https://github.com/kristapsdz/kcaldav
- https://github.com/kewisch/ical.js/?tab=readme-ov-file (basically a rough libical port)

## WGPU

## Automerge

## Native UI
