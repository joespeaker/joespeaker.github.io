# open txt.txt and randomize the lines

import random

# open txt.txt
f = open("txt.txt", "r")
lines = f.readlines()
f.close()

# randomize the lines
random.shuffle(lines)

# write the randomized lines to txt.txt
f = open("txt.txt", "w")
f.writelines(lines)

# close txt.txt
f.close()

