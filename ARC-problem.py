import json
from encode import encode
from decode import decode
from chess import Board

def arc_to_chess(arc_data):
    pgn_string = ""
    for split in ["train", "test"]:
        for example in arc_data[split]:
            input_grid = example["input"]
            output_grid = example["output"]
            combined_grid = input_grid + output_grid

            # Flatten and convert to string
            flattened_grid = [str(item) for sublist in combined_grid for item in sublist]
            grid_string = "".join(flattened_grid)

            # Encode grid string to PGN
            temp_file = "temp_grid.txt"
            with open(temp_file, "w") as f:
                f.write(grid_string)
            pgn_string += encode(temp_file) + "\n\n"

    return pgn_string



def chess_to_arc(pgn_string, original_arc_data):
    # Decode the PGN string back to a file
    temp_file = "temp_decoded.txt"
    decode(pgn_string, temp_file)

    # Read the decoded content
    with open(temp_file, "r") as f:
        decoded_string = f.read()
    
    # Process decoded string back into ARC format
    decoded_data = {}
    for split in ["train", "test"]:
        decoded_data[split] = []
        for i in range(len(original_arc_data[split])):
            input_len = len(original_arc_data[split][i]["input"][0])
            output_len = len(original_arc_data[split][i]["output"][0])
            total_len = input_len + output_len

            grid_string = decoded_string[:total_len]  # Get the relevant substring
            decoded_string = decoded_string[total_len:]  # Remove the extracted portion

            input_grid = [[int(grid_string[j]) for j in range(k * input_len, (k + 1) * input_len)] for k in range(1)]
            output_grid = [[int(grid_string[j]) for j in range(input_len + k * output_len, input_len + (k+1) * output_len)] for k in range(1)]

            decoded_data[split].append({"input": input_grid, "output": output_grid})
            
    return decoded_data



# Example usage:
arc_data = json.loads('{"train": [{"input": [[0, 0, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 0, 0, 0, 7]], "output": [[0, 0, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7]]}, {"input": [[0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 7]], "output": [[0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 7]]}, {"input": [[0, 0, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 0, 0, 0, 0, 0, 7, 0]], "output": [[0, 0, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 0]]}], "test": [{"input": [[0, 0, 0, 0, 0, 5, 5, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7]], "output": [[0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 7]]}]}')


pgn_string = arc_to_chess(arc_data)
decoded_arc_data = chess_to_arc(pgn_string, arc_data)


print(json.dumps(decoded_arc_data, indent=4))