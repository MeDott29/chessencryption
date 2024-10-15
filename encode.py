from time import time
from chess import Board, pgn
import io

def encode(file_path: str):
    start_time = time()

    # Read binary of file
    print("Reading file...")
    with open(file_path, "rb") as file:
        file_bytes = file.read()

    print(f"File size: {len(file_bytes)} bytes")

    print("\nEncoding file...")

    board1 = Board()
    board2 = Board()
    game1 = pgn.Game()
    game2 = pgn.Game()
    node1 = game1
    node2 = game2

    for byte in file_bytes:
        for i in range(4):  # Process 2 bits at a time
            two_bits = (byte >> (6 - i*2)) & 0b11
            
            legal_moves1 = list(board1.legal_moves)
            legal_moves2 = list(board2.legal_moves)
            
            move1 = legal_moves1[two_bits % len(legal_moves1)]
            move2 = legal_moves2[two_bits // len(legal_moves1)]
            
            board1.push(move1)
            board2.push(move2)
            
            node1 = node1.add_variation(move1)
            node2 = node2.add_variation(move2)

    print(f"\nSuccessfully converted file to PGN with 2 games ({round(time() - start_time, 3)}s).")

    # Combine both games into a single PGN string
    output = io.StringIO()
    exporter = pgn.FileExporter(output)
    game1.accept(exporter)
    output.write("\n\n")
    game2.accept(exporter)

    pgn_string = output.getvalue()
    print(f"PGN string length: {len(pgn_string)}")

    return pgn_string
