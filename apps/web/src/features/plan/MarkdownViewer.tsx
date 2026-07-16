import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

const markdownComponents: Components = {
  h1: ({ node: _node, ...props }) => (
    <h1 className="mt-8 mb-4 text-3xl font-semibold tracking-tight first:mt-0" {...props} />
  ),
  h2: ({ node: _node, ...props }) => (
    <h2 className="mt-8 mb-3 border-b pb-2 text-2xl font-semibold tracking-tight" {...props} />
  ),
  h3: ({ node: _node, ...props }) => (
    <h3 className="mt-6 mb-2 text-xl font-semibold tracking-tight" {...props} />
  ),
  h4: ({ node: _node, ...props }) => (
    <h4 className="mt-5 mb-2 text-base font-semibold" {...props} />
  ),
  p: ({ node: _node, ...props }) => (
    <p className="my-4 leading-7 first:mt-0 last:mb-0" {...props} />
  ),
  a: ({ node: _node, href, ...props }) => {
    const external = href?.startsWith("http://") || href?.startsWith("https://");
    return (
      <a
        href={href}
        className="font-medium underline underline-offset-4 hover:text-muted-foreground"
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
        {...props}
      />
    );
  },
  blockquote: ({ node: _node, ...props }) => (
    <blockquote
      className="my-4 border-l-2 pl-4 text-muted-foreground italic"
      {...props}
    />
  ),
  ul: ({ node: _node, ...props }) => (
    <ul className="my-4 flex list-disc flex-col gap-1 pl-6" {...props} />
  ),
  ol: ({ node: _node, ...props }) => (
    <ol className="my-4 flex list-decimal flex-col gap-1 pl-6" {...props} />
  ),
  li: ({ node: _node, className, ...props }) => (
    <li className={cn("leading-7", className)} {...props} />
  ),
  input: ({ node: _node, ...props }) => (
    <input className="mr-2 align-middle" disabled {...props} />
  ),
  hr: ({ node: _node, ...props }) => <hr className="my-8 border-border" {...props} />,
  pre: ({ node: _node, ...props }) => (
    <pre
      className="my-4 overflow-x-auto rounded-lg border bg-card p-4 font-mono text-sm"
      {...props}
    />
  ),
  code: ({ node: _node, className, ...props }) => (
    <code
      className={cn(
        className
          ? "font-mono text-sm"
          : "rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]",
        className
      )}
      {...props}
    />
  ),
  table: ({ node: _node, ...props }) => (
    <div className="my-4 overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  thead: ({ node: _node, ...props }) => <thead className="bg-muted" {...props} />,
  th: ({ node: _node, ...props }) => (
    <th className="border-b px-3 py-2 text-left font-medium" {...props} />
  ),
  td: ({ node: _node, ...props }) => (
    <td className="border-b px-3 py-2 align-top last:border-r-0" {...props} />
  )
};

export function MarkdownViewer({ content }: { readonly content: string }) {
  return (
    <article className="text-foreground">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={markdownComponents}
      >
        {content}
      </Markdown>
    </article>
  );
}
