import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const pages = defineCollection({
  loader: glob({ base: "./src/content/pages", pattern: "**/*.json" }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      blocks: z
        .array(
          z.discriminatedUnion("type", [
            z.object({
              type: z.literal("hero"),
              eyebrow: z.string(),
              titularCursiva: z.string(),
              titularNegrita: z.string(),
              titulo: z.string(),
              botonPrincipal: z.string(),
              botonSecundario: z.string(),
              subtitulo: z.string(),
              retrato: image(),
              retratoAlt: z.string(),
            }),
            z.object({
              type: z.literal("servicios"),
              encabezado: z.string(),
              texto: z.string(),
            }),
          ]),
        )
        .default([]),
    }),
});

const navbar = defineCollection({
  loader: glob({ base: "./src/content/navbar", pattern: "**/*.json" }),
  schema: z.object({
    title: z.string(),
    marca: z.string(),
    enlaces: z.array(
      z.object({
        etiqueta: z.string(),
        href: z.string(),
      }),
    ),
    contacto: z.string(),
  }),
});

export const collections = { pages, navbar };
