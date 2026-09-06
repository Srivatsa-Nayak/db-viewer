package com.dbviewer.dto;

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
}
