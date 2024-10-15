Attention: Claude is the most knowledgeable resource I've contacted while creating my contributions to this repository.
- check [CLAUDEME.md](CLAUDEME.md) a summary of the I tried to improve the accuracey of the encoding decoding.

# 🔑 Chess Encryption

Encrypt files into pairs of Chess games stored in PGN format.<br>
From the YouTube video: [Storing Files in Chess Games for Free Cloud Storage](https://youtu.be/TUtafoC4-7k?feature=shared)

This is a library so you will need to import functions from `decode.py` and `encode.py` to use this. The library now uses two chess games simultaneously to increase the resolution and accuracy of the encoding/decoding pipeline.

## Usage

### Encoding
```python
from encode import encode

pgn_string = encode("path/to/your/file")
```

### Decoding
```python
from decode import decode

decoded_file_path = decode(pgn_string, "path/to/output/file")
```

Note: The PGN string now contains two games for each encoded file. Make sure to provide both games when decoding.

I have written some small documentation to help using them, although I won't generally be providing support for this software. I'm just uploading it for others with an interest in the algorithm etc.
