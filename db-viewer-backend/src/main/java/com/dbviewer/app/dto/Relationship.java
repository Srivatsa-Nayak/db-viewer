package com.dbviewer.app.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Mirrors Go Relationship */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Relationship {
    private String sourceTable;
    private String targetTable;
    private String sourceColumn;
    private String targetColumn;

    /**
     * The engine's own id for the constraint this column belongs to.
     *
     * <p>Composite foreign keys are several rows sharing one id. Without it the UI cannot tell
     * "two columns of one constraint" from "two separate constraints", and draws two overlapping
     * edges where there is one relationship.
     */
    private Integer constraintId;

    /** The declared ON DELETE action ({@code CASCADE}, {@code SET NULL}, …), or null for none. */
    private String onDelete;
}
