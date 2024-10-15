import json
from encode import encode
from decode import decode
from chess import Board

def arc_to_chess(arc_data):
    all_data = []
    for split in ["train", "test"]:
        for example in arc_data[split]:
            input_grid = example["input"]
            output_grid = example["output"]
            
            # Flatten the grids
            flattened_input = [str(item) for sublist in input_grid for item in sublist]
            flattened_output = [str(item) for sublist in output_grid for item in sublist]
            
            combined_grid = flattened_input + flattened_output
            all_data.extend(combined_grid)

    grid_string = "".join(all_data)

    # Encode grid string to PGN
    temp_file = "temp_grid.txt"
    with open(temp_file, "w") as f:
        f.write(grid_string)
    
    return encode(temp_file)

def save_pgn_to_file(pgn_string, filename="chess_game_data.pgn"):
    with open(filename, "w") as f:
        f.write(pgn_string)
    print(f"PGN data saved to {filename}")

def chess_to_arc(pgn_string, original_arc_data):
    # Decode the PGN string back to a file
    temp_file = "temp_decoded.txt"
    decode(pgn_string, temp_file)

    # Read the decoded content
    with open(temp_file, "r") as f:
        decoded_string = f.read()
    
    print(f"Decoded string length: {len(decoded_string)}")
    
    # Process decoded string back into ARC format
    decoded_data = {"train": [], "test": []}
    for split in ["train", "test"]:
        for example in original_arc_data[split]:
            input_len = len(example["input"][0]) * len(example["input"])
            output_len = len(example["output"][0]) * len(example["output"])
            total_len = input_len + output_len

            if len(decoded_string) < total_len:
                print(f"Warning: Decoded string is shorter than expected for {split} example")
                print(f"Expected length: {total_len}, Actual length: {len(decoded_string)}")
                break

            grid_string = decoded_string[:total_len]
            decoded_string = decoded_string[total_len:]

            input_grid = [
                [int(grid_string[j]) for j in range(k * len(example["input"][0]), (k + 1) * len(example["input"][0]))]
                for k in range(len(example["input"]))
            ]
            output_grid = [
                [int(grid_string[j]) for j in range(input_len + k * len(example["output"][0]), input_len + (k + 1) * len(example["output"][0]))]
                for k in range(len(example["output"]))
            ]

            decoded_data[split].append({"input": input_grid, "output": output_grid})
    
    return decoded_data


def check_match(original_data, decoded_data):
    mismatches = []
    for split in ["train", "test"]:
        for i, (original, decoded) in enumerate(zip(original_data[split], decoded_data[split])):
            if original != decoded:
                mismatches.append({"split": split, "index": i, "original": original, "decoded": decoded})
    return mismatches


# Example usage:
arc_data = json.loads('{"train": [{"input": [[0, 0, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 0, 0, 0, 7]], "output": [[0, 0, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7]]}, {"input": [[0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 7]], "output": [[0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 7]]}, {"input": [[0, 0, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 0, 0, 0, 0, 0, 7, 0]], "output": [[0, 0, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 0]]}], "test": [{"input": [[0, 0, 0, 0, 0, 5, 5, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7]], "output": [[0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 7]]}]}')

pgn_string = arc_to_chess(arc_data)
save_pgn_to_file(pgn_string)

decoded_arc_data = chess_to_arc(pgn_string, arc_data)

# Check if the decoded data matches the original data
mismatches = check_match(arc_data, decoded_arc_data)
if mismatches:
    print("Match status: False")
    for mismatch in mismatches:
        print("Mismatch at split:", mismatch["split"], "index:", mismatch["index"])
        print("Original:", json.dumps(mismatch["original"], indent=4))
        print("Decoded:", json.dumps(mismatch["decoded"], indent=4))
else:
    print("Match status: True")

print(json.dumps(decoded_arc_data, indent=4))
