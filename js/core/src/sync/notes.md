# Sync notes

Example timeline

action | last sync | last modified | inflight
-----------------------------------------------------
create | NULL      | A=NOW         | NULL
sync   | NULL      | A             | B=NOW
edit   | NULL      | C=NOW         | B
ack    | B         | C             | NULL
sync   | B         | C             | NOW

In this example there's an immediate retrigger after ack as edits were made while last sync was in flight

A remote create could start off with both last sync & last modified = NULL || NOW. The effect is the same, as no local modifications are present. it might be better to have them equal.

I don't need to save in-flight data to local cache - i just assume it failed. So I load last sync + last modified for all items - I could index this, but honestly seeing as I have to load all items anyway, I can just compute them on load. If i'm NOT loading all historical items (which is a wise decision, then maybe an index is worth it)
