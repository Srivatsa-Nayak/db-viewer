package com.dbviewer.service;

import lombok.Getter;

import java.util.List;

/**
 * Thrown when a table cannot be dropped because another table's foreign key references it.
 * Maps to 409 Conflict, and carries the dependents so the UI can name them.
 */
@Getter
public class TableInUseException extends RuntimeException {

    private final String tableName;
    private final List<String> referencedBy;

    public TableInUseException(String tableName, List<String> referencedBy) {
        super(String.format("\"%s\" is referenced by %s. Delete %s first, or remove the foreign key.",
                tableName, String.join(", ", referencedBy),
                referencedBy.size() == 1 ? "that table" : "those tables"));
        this.tableName = tableName;
        this.referencedBy = referencedBy;
    }
}
