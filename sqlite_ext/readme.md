# sqlite extensions
See [docs](https://github.com/nalgeon/sqlean/blob/main/docs/uuid.md)

## Installing uuid extension

1. Download release for your platform
[https://github.com/nalgeon/sqlean/releases/tag/0.27.2](https://github.com/nalgeon/sqlean/releases/tag/0.27.2)

2. Load extension
```bash
mkdir /usr/local/lib/sqlite3
curl -LO https://github.com/nalgeon/sqlean/releases/download/0.27.2/sqlean-linux-x86.zip
sudo unzip sqlean-linux-x86.zip -d /usr/local/lib/sqlite3/
rm sqlean-linux-x86.zip
# confirm uuid loaded
sqlite3 <<< "
.load /usr/local/lib/sqlite3/uuid
select uuid4();"
cp .sqliterc ~ # loads automatically
# confirm automatically loaded
sqlite3 <<< "select uuid4();"
```

## Example queries
- `SELECT uuid4();`
- `SELECT uuid_str(id) FROM session;`
