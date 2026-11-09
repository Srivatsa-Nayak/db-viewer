import type { Edge, Node } from "reactflow";
import type { ExplorerFile } from "@/components/editor/FileExplorer";
import type { CanvasGroup, Relationship, TagColour } from "@/types";

/**
 * One open SQL file. The `id` is also the backend workspace id: the backend keeps a
 * separate database per id, so tables created in one file are invisible to every
 * other file and two files may reuse the same table names.
 */
export interface Workspace {
    id: string;
    name: string;
    nodes: Node[];
    edges: Edge[];
    /**
     * The relationships as the backend reported them, kept beside the edges they produced.
     *
     * An `Edge` is a drawing instruction — two node ids and two handle ids — and the text
     * exports need the schema, not the drawing. Deriving one back from the other would mean
     * parsing handle ids, which is exactly the sort of thing that quietly stops working.
     */
    relationships: Relationship[];
    fileData: ExplorerFile;
    isImported: boolean;
    /**
     * Everything the user has said *about* a table, as opposed to what the database says.
     *
     * Kept out of the nodes on purpose. `refreshActiveSchema` rebuilds every node from the server
     * response, so anything living on a node is destroyed by the next refresh — colour was the
     * first thing to hit that, and grouping, ghosting and collapsed state would each hit it again.
     * Decorations live here, keyed by table name, and are folded onto the nodes at render time.
     */
    decorations: Record<string, NodeDecoration>;
    /** Named boundaries drawn around sets of tables. Members, not geometry — see `CanvasGroup`. */
    groups: CanvasGroup[];
}

/**
 * A user's annotations on one table.
 *
 * Presentational fields are applied as a `className`, never through node `data`: React Flow
 * compares `data` by reference, so putting a colour in it would rebuild every node's data object
 * and re-render the whole canvas on each frame of a drag. `DemoCanvas` documents the same rule for
 * its refused-delete styling.
 */
export interface NodeDecoration {
    /** A token name (`brand`, `teal`, …), never a hex value — see the `--color-tag-*` ramp. */
    colour?: TagColour;
    /** A short free-text label, e.g. "Billing". */
    tag?: string;
}
