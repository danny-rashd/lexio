# Vocabulary File Format

Files live in `data/languages/<language>/<topic>/`. Any `.csv` or `.tsv`
file in a topic folder is a valid import source.

## Folder structure

```
data/languages/
├── spanish/
│   ├── greetings/
│   │   └── basics.csv
│   ├── food/
│   │   └── food.csv
│   └── verbs/
│       └── present_tense.csv
├── mandarin/
│   └── hsk1/
│       └── vocab.csv
├── japanese/
│   └── n5/
│       └── basics.csv
└── norsk/
    ├── greetings/
    │   └── basics.csv
    └── basics/
        └── everyday.csv
```

## CSV format

```
word,meaning,native
hola,hello,
konnichiwa,hello,こんにちは
ni hao,hello,你好
```

## TSV format

```
word	meaning	native
hola	hello	
```

## Column rules

| Column   | Required | Description |
|----------|----------|-------------|
| `word`   | Yes | The word in the target language. For Japanese/Mandarin: romaji or pinyin. |
| `meaning`| Yes | The English translation. |
| `native` | No  | Native script (kanji, kana, hanzi). Leave blank for Latin-script languages. |

## General rules

- First row must be the header: `word,meaning,native`
- Delimiter auto-detected from file extension (`.csv` → comma, `.tsv` → tab)
- File must be UTF-8 encoded (required for CJK, Arabic, accented characters)
- Lines starting with `#` are comments and are skipped
- Rows with an empty `meaning` are skipped
- Re-importing the same file is safe — duplicates are skipped automatically
- Language and topic names are normalised to lowercase on import
