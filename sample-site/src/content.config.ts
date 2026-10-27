import { file, glob } from "astro/loaders";
import { defineCollection, reference } from "astro:content";
import { z } from "astro/zod";

// Homepage collection schema
const homepageCollection = defineCollection({
  loader: glob({ pattern: "**/-*.{md,mdx}", base: "src/content/homepage" }),
  schema: z.object({
    banner: z
      .object({
        title: z.string().optional(),
        content: z.string().optional(),
        image: z.string().optional(),
        button: z
          .object({
            label: z.string(),
            link: z.string().default("/contact"),
            enable: z.boolean().default(true),
          })
          .optional(),
      })
      .optional(),
    feature: z.object({
      title: z.string(),
      features: z.array(
        z.object({
          name: z.string(),
          icon: z.string().optional(),
          content: z.string().optional(),
        }),
      ),
    }),
    services: z
      .array(
        z.object({
          title: z.string().optional(),
          content: z.string().optional(),
          images: z.array(z.string()).optional(),
          button: z
            .object({
              label: z.string(),
              link: z.string().default("/contact"),
              enable: z.boolean().default(true),
            })
            .optional(),
        }),
      )
      .optional(),
    workflow: z
      .object({
        title: z.string().optional(),
        description: z.string().optional(),
        image: z.string(),
      })
      .optional(),
    call_to_action: z
      .object({
        title: z.string().optional(),
        content: z.string().optional(),
        image: z.string(),
        button: z
          .object({
            label: z.string(),
            link: z.string().default("/contact"),
            enable: z.boolean().default(true),
          })
          .optional(),
      })
      .optional(),
  }),
});

//Contact collection schema
const contactCollection = defineCollection({
  loader: glob({ pattern: "**/-*.{md,mdx}", base: "src/content/contact" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    draft: z.boolean(),
    info: z.object({
      title: z.string(),
      description: z.string(),
      contacts: z.array(z.string()),
    }),
  }),
});

//pricing collection schema
const pricingCollection = defineCollection({
  loader: glob({ pattern: "**/-*.{md,mdx}", base: "src/content/pricing" }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    draft: z.boolean(),
    plans: z
      .array(
        z.object({
          title: z.string(),
          subtitle: z.string().optional(),
          price: z.number(),
          price_yearly: z.number().optional(),
          type: z.string(),
          recommended: z.boolean().optional(),
          features: z.array(z.string()),
          button: z.object({
            label: z.string(),
            link: z.string().default("/contact"),
          }),
        }),
      )
      .optional(),

    call_to_action: z
      .object({
        title: z.string(),
        content: z.string(),
        image: z.string(),
        button: z
          .object({
            enable: z.boolean().default(true),
            label: z.string(),
            link: z.string().default("/contact"),
          })
          .optional(),
      })
      .optional(),
  }),
});

// FAQ collection schema
const faqCollection = defineCollection({
  loader: glob({ pattern: "**/-*.{md,mdx}", base: "src/content/faq" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    draft: z.boolean(),
    faqs: z.array(
      z.object({
        title: z.string(),
        answer: z.string(),
      }),
    ),
  }),
});

// Authors collection schema (one JSON file per author, avatar through image())
const authorsCollection = defineCollection({
  loader: glob({ pattern: "**/*.{json,yaml}", base: "src/content/authors" }),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      role: z.string(),
      bio: z.string(),
      avatar: image(),
    }),
});

// Testimonials collection: many entries in ONE file (file() loader), so the
// document is the entry, not the file. Referenced by landing page blocks.
const testimonialsCollection = defineCollection({
  loader: file("src/content/testimonials.json"),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      role: z.string(),
      quote: z.string(),
      avatar: image().optional(),
    }),
});

// Partners: a YAML-only collection (one file each, dates unquoted in the YAML).
const partnersCollection = defineCollection({
  loader: glob({ pattern: "**/*.yaml", base: "src/content/partners" }),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      logo: image(),
      url: z.string().url(),
      order: z.number(),
      since: z.coerce.date(),
    }),
});

// Stats: many entries in ONE YAML file. "updated" is a plain z.date() on
// purpose (D13: does the overlay's ISO string need reviving?).
const statsCollection = defineCollection({
  loader: file("src/content/stats.yaml"),
  schema: z.object({
    label: z.string(),
    value: z.string(),
    updated: z.date(),
  }),
});

// Landing pages: a page builder. `blocks` is a discriminated union on `type`;
// each type has a component in src/layouts/blocks/.
const button = z.object({
  label: z.string(),
  link: z.string().default("/contact"),
  enable: z.boolean().default(true),
});

const landingBlock = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("banner"),
    title: z.string(),
    content: z.string().optional(),
    image: z.string().optional(),
    button: button.optional(),
  }),
  z.object({
    type: z.literal("features"),
    title: z.string(),
    items: z.array(
      z.object({
        name: z.string(),
        icon: z.string().optional(),
        content: z.string().optional(),
      }),
    ),
  }),
  z.object({
    type: z.literal("services"),
    items: z.array(
      z.object({
        title: z.string(),
        content: z.string(),
        images: z.array(z.string()),
        button: button.optional(),
      }),
    ),
  }),
  z.object({
    type: z.literal("workflow"),
    title: z.string(),
    description: z.string().optional(),
    image: z.string(),
  }),
  z.object({
    type: z.literal("cta"),
    title: z.string(),
    content: z.string(),
    image: z.string(),
    button: button.optional(),
  }),
  z.object({
    type: z.literal("pricing"),
    title: z.string(),
    plans: z.array(
      z.object({
        title: z.string(),
        subtitle: z.string().optional(),
        price: z.number(),
        price_yearly: z.number().optional(),
        type: z.string(),
        recommended: z.boolean().optional(),
        features: z.array(z.string()),
        button: z.object({
          label: z.string(),
          link: z.string().default("/contact"),
        }),
      }),
    ),
  }),
  z.object({
    type: z.literal("faq"),
    title: z.string(),
    items: z.array(z.object({ question: z.string(), answer: z.string() })),
  }),
  z.object({
    type: z.literal("highlight"),
    title: z.string(),
    body: z.string(),
  }),
  z.object({
    type: z.literal("partners"),
    title: z.string(),
  }),
  z.object({
    type: z.literal("stats"),
    title: z.string(),
  }),
  z.object({
    type: z.literal("testimonials"),
    title: z.string(),
    items: z.array(reference("testimonials")),
  }),
]);

const landingCollection = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "src/content/landing" }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    blocks: z.array(landingBlock),
  }),
});

// Blog collection schema
const blogCollection = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "src/content/blog" }),
  schema: ({ image }) =>
    z.object({
    title: z.string(),
    meta_title: z.string().optional(),
    description: z.string().optional(),
    date: z.coerce.date().optional(),
    image: z.string().optional(),
    cover: image().optional(),
    author: reference("authors").optional(),
    authors: z.array(z.string()).default(() => ["admin"]),
    categories: z.array(z.string()).default(() => ["others"]),
    tags: z.array(z.string()).default(() => ["others"]),
    draft: z.boolean().optional(),
  }),
});

// Pages collection schema
const pagesCollection = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "src/content/pages" }),
  schema: z.object({
    title: z.string(),
    meta_title: z.string().optional(),
    description: z.string().optional(),
    image: z.string().optional(),
    draft: z.boolean().optional(),
  }),
});

// Export collections
export const collections = {
  homepage: homepageCollection,
  authors: authorsCollection,
  testimonials: testimonialsCollection,
  partners: partnersCollection,
  stats: statsCollection,
  landing: landingCollection,
  blog: blogCollection,
  pages: pagesCollection,
  contact: contactCollection,
  pricing: pricingCollection,
  faq: faqCollection,
};
