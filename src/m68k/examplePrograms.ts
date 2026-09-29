// examplePrograms.ts — programas M68K de demostración.

export const EXAMPLE_M68K_PROGRAM = `; Suma 5 + 3 con MOVEQ, ADDQ, ADD y STOP.
        ORG     $1000
        MOVEQ   #5,D0            ; D0 = 5
        MOVEQ   #3,D1            ; D1 = 3
        ADDQ.W  #2,D0            ; D0 = 7
        ADD.W   D1,D0            ; D0 = 10
        STOP    #$2700           ; halt
`;

export const FACTORIAL_M68K_PROGRAM = `; Factorial de 4 con JSR/RTS.
;   D0 = resultado
        ORG     $1000
        MOVEQ   #4,D0            ; n
        BSR.S   fact
        STOP    #$2700
fact:   ADDQ.W  #1,D0
        RTS
`;
