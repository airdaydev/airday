# Storing LWW-Registers

K I S S, optimise later = pick option 1

## Option 1: Storing as value + int columns
item {
  text_data = TEXT,
  text_utc = INTEGER,
  text_pid = INTEGER,
}

Obvious advantage = obviously simple, sql idiomatic way, can potentially implement merge without application code even

disadvantage = hardcoding, difficult to extend schema

## Option 2a: Storing as flatbuffer blob (DISCARD THIS, too much wrap)
item {
  text_data = FLATBUFFER(u64, u64, String),
  completed_data = FLATBUFFER(u64, u64, boolean),
}

Strong type guarantees through application code, low storage requirements, fast reads, potentially can flow all the way through websocket -> db. Can't do a db look up on only attributes since time

can't look at db easily, which is not a bad thing for privacy

i'm dismissing this ootb because i want to be able to work with sqlite easily and analyse everything easily and prove correctness and these introduce too much obscurity

## Option 3: JSON columns (same shit)
attributes TEXT NOT NULL DEFAULT '{}' = JSON col with everything.
AND json_extract(attributes, '$[*].utc') > ?
If this benchmarks close to opt 1 it is so so much better than option 4 & 1

## Option 4: Item_attributes AV (useful, but application side pain)
!FUTURE ADDITION!
Attribute-Value
```
CREATE TABLE IF NOT EXISTS item_attributes (
  item_id UUID NOT NULL (references item.id),
  attr TEXT NOT NULL, (arbitray)
  -- values
  value_type TEXT NOT NULL,
  value_text TEXT,
  value_integer INTEGER,
  -- clock
  utc INTEGER NOT NULL DEFAULT 0,
  pid INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (uuid, attr)
);
```

much more uniform code path than opt 1, ready to go if i want to add dynamic columns

Some sparseness, but not as sparse as opt 1 if not filled (e.g. 2 NULL per extant row, 20 NULL if you had 10 full cols, however item row option would start off with 20 NULL and gradually decrease) - hmm not worth thinking about overall.

Attribute level bulk db reads (e.g. get all attributes where x < utc > x) - down sync is pretty much done. option 1 this really has to be done on application side, so this IS tempting.

simpler queries overall (no hardcoding each type / statically looping over each type) - ok but what about bulk item updates - not so fast huh

less type safety

i can actually grab 1 item's props without joins (well.. maybe not a good idea because it could be on another workspace & u have to verify that static property with a join - or at least another look up)

lotta fkn rows to mash together when bulking = more disk i/o (or more netty reqs when moving to postgres)

## Bulk example
so if i'm updating 200 items at a time (use case would be dragging a bunch of items from one list to another) - i guess i get those 200 in one go in a transaction (potentially in a stream), read them and determine if the new timestamp is greater, for each that succeeds, build update statements (potentially only one in bulk if the items are moving all too the same list). Best to keep LWW-merge in application code.

## Single example
i'm updating any 4 attributes on one item, EAV probably easiest to write the code for

## Bulk read
i'm grabbing the first 250 items since the beginning of time (is that creation time or last update time?) - i guess last update time! only in the EAV case really could i isolate only the changed attributes without first checking over EVERYTHING in application code
