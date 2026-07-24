import { Link } from "@tanstack/react-router";
import { Fragment } from "react";

export type Crumb =
  | { label: string; to: "/"; params?: undefined }
  | { label: string; to: "/film/$slug"; params: { slug: string } }
  | { label: string; to: "/biograf/$slug"; params: { slug: string } }
  | { label: string; to: "/by/$city"; params: { city: string } }
  | { label: string; current: true };

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="breadcrumb" className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <Fragment key={i}>
              <li className={isLast ? "text-foreground" : ""}>
                {"current" in item ? (
                  <span aria-current="page" className="line-clamp-1">
                    {item.label}
                  </span>
                ) : item.to === "/" ? (
                  <Link to="/" className="hover:text-foreground">
                    {item.label}
                  </Link>
                ) : item.to === "/film/$slug" ? (
                  <Link to="/film/$slug" params={item.params} className="hover:text-foreground">
                    {item.label}
                  </Link>
                ) : item.to === "/biograf/$slug" ? (
                  <Link to="/biograf/$slug" params={item.params} className="hover:text-foreground">
                    {item.label}
                  </Link>
                ) : (
                  <Link to="/by/$city" params={item.params} className="hover:text-foreground">
                    {item.label}
                  </Link>
                )}
              </li>
              {!isLast && (
                <li aria-hidden="true" className="text-foreground/30">
                  /
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
