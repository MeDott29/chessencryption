from time import time
from math import log2
from chess import pgn, Board
from util import to_binary_string
import heapq

###
### Enter a file path
### and it returns a string of 1 or more PGNs that represent it
###
def encode(file_path: str):
    start_time = time()

    # read binary of file
    print("reading file...")

    file_bytes = list(open(file_path, "rb").read())

    # record number of bits in file
    file_bits_count = len(file_bytes) * 8

    # convert file to chess moves
    print("\nencoding file...")

    output_pgns: list[str] = []

    file_bit_index = 0

    chess_board = Board()

    # create a dictionary to store the frequency of each byte
    byte_frequency = {}
    for byte in file_bytes:
        if byte not in byte_frequency:
            byte_frequency[byte] = 0
        byte_frequency[byte] += 1

    # create a heap to store the bytes with their frequencies
    heap = []
    for byte, frequency in byte_frequency.items():
        heapq.heappush(heap, (-frequency, byte))

    # create a dictionary to store the Huffman codes
    huffman_codes = {}
    while heap:
        # extract the two bytes with the highest frequencies
        frequency1, byte1 = heapq.heappop(heap)
        frequency2, byte2 = heapq.heappop(heap)

        # create a new byte with the combined frequency
        new_frequency = frequency1 + frequency2
        new_byte = byte1 + byte2

        # update the Huffman codes
        huffman_codes[byte1] = huffman_codes.get(byte1, "") + "0"
        huffman_codes[byte2] = huffman_codes.get(byte2, "") + "1"

        # push the new byte back into the heap
        heapq.heappush(heap, (new_frequency, new_byte))

    # encode the file using the Huffman codes
    encoded_file = ""
    for byte in file_bytes:
        encoded_file += huffman_codes[byte]

    # convert the encoded file to chess moves
    chess_moves = []
    for i in range(0, len(encoded_file), 8):
        move_binary = encoded_file[i:i+8]
        move = chess_board.move_stack[-1].uci()
        chess_moves.append(move)

    # convert the chess moves to PGNs
    pgn_board = pgn.Game()
    pgn_board.add_line(chess_moves)

    output_pgns.append(str(pgn_board))

    print(
        f"\nsuccessfully converted file to pgn with "
        + f"{len(output_pgns)} game(s) "
        + f"({round(time() - start_time, 3)}s)."
    )

    # return pgn string
    return "\n\n".join(output_pgns)
