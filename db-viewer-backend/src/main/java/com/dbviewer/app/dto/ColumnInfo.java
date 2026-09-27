package com.dbviewer.app.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Mirrors Go ColumnInfo */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ColumnInfo {
    private String name;
    private String type;

    /**
     * Primary-key flag, serialized as {@code isPk} because that is what the UI reads.
     * The field deliberately avoids an {@code is} prefix - see {@code ColumnDefinition}
     * for why that spelling breaks Jackson binding.
     */
    @JsonProperty("isPk")
    private boolean pk;

    /** True when the column is declared NOT NULL. Used to pre-fill the "Edit column" form. */
    private boolean notNull;

    /**
     * True when a single-column UNIQUE index covers this column, or it is the sole primary key.
     *
     * <p>Load-bearing for the diagram, not decoration: it is what separates a one-to-one
     * relationship from a one-to-many. A foreign key on a unique column can match at most one row,
     * and the crow's-foot notation has to say so.
     */
    private boolean unique;

    /** The column's DEFAULT as written in the schema, or null. Shown in the column tooltip. */
    private String defaultValue;

    /** True for an AUTOINCREMENT / AUTO_INCREMENT key. */
    private boolean autoIncrement;
}
