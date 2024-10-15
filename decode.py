from time import time
from chess import pgn, Board
from io import StringIO

def decode(pgn_string: str, output_file_path: str):
    start_time = time()

    # Load games from PGN string
    pgn_io = StringIO(pgn_string)
    game1 = pgn.read_game(pgn_io)
    game2 = pgn.read_game(pgn_io)

    if not game1 or not game2:
        raise ValueError("Invalid PGN string: couldn't read two games")

    board1 = game1.board()
    board2 = game2.board()

    output_bytes = bytearray()
    current_byte = 0
    bit_count = 0

    for node1, node2 in zip(game1.mainline(), game2.mainline()):
        move1 = node1.move
        move2 = node2.move

        legal_moves1 = list(board1.legal_moves)
        legal_moves2 = list(board2.legal_moves)

        two_bits = (legal_moves1.index(move1) + 
                    legal_moves2.index(move2) * len(legal_moves1)) & 0b11

        current_byte = (current_byte << 2) | two_bits
        bit_count += 2

        if bit_count == 8:
            output_bytes.append(current_byte)
            current_byte = 0
            bit_count = 0

        board1.push(move1)
        board2.push(move2)

    # Handle any remaining bits
    if bit_count > 0:
        current_byte <<= (8 - bit_count)
        output_bytes.append(current_byte)

    # Write decoded bytes to file
    with open(output_file_path, "wb") as output_file:
        output_file.write(output_bytes)

    print(f"\nSuccessfully decoded PGN with 2 games ({round(time() - start_time, 3)}s).")

    return output_file_path
