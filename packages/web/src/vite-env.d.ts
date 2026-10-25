/// <reference types="vite/client" />

/**
 * Los tipos de Vite, y con ellos las declaraciones de los módulos que no son
 * TypeScript: `import './styles/tokens.css'` es una importación de efecto
 * secundario y, desde TypeScript 7, sin la declaración de `*.css` es el error
 * TS2882. El archivo vive aquí y no en `tsconfig` para que valga también a
 * Vite, que ya trata este nombre como su punto de tipos.
 */
