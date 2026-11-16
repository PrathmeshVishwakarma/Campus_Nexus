start:
    XOR BL, BL       ; positive count
    XOR BH, BH       ; negative count


    MOV AL, 5
    TEST AL, AL
    JS neg1
    JZ skip1
    INC BL
    JMP next1
neg1:
    INC BH
    NEG AL
    MOV DL, AL
skip1:
next1:


    MOV AL, -3
    TEST AL, AL
    JS neg2
    JZ skip2
    INC BL
    JMP next2
neg2:
    INC BH
    NEG AL
    MOV DL, AL
skip2:
next2:


    MOV AL, 12
    TEST AL, AL
    JS neg3
    JZ skip3
    INC BL
    JMP next3
neg3:
    INC BH
    NEG AL
    MOV DL, AL
skip3:
next3:


    MOV AL, -8
    TEST AL, AL
    JS neg4
    JZ skip4
    INC BL
    JMP next4
neg4:
    INC BH
    NEG AL
    MOV DL, AL
skip4:
next4:


    MOV AL, 0
    TEST AL, AL
    JS neg5
    JZ skip5
    INC BL
    JMP next5
neg5:
    INC BH
    NEG AL
    MOV DL, AL
skip5:
next5:

    MOV AL, -1
    TEST AL, AL
    JS neg6
    JZ skip6
    INC BL
    JMP next6
neg6:
    INC BH
    NEG AL
    MOV DL, AL
skip6:
next6:


    MOV AL, 7
    TEST AL, AL
    JS neg7
    JZ skip7
    INC BL
    JMP next7
neg7:
    INC BH
    NEG AL
    MOV DL, AL
skip7:
next7:


    MOV AL, -15
    TEST AL, AL
    JS neg8
    JZ skip8
    INC BL
    JMP next8
neg8:
    INC BH
    NEG AL
    MOV DL, AL
skip8:
next8:

HLT
