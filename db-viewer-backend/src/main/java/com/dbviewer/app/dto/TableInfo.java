package com.dbviewer.app.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/** Mirrors Go TableInfo */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TableInfo {

    /**
     * True when this is a view rather than a table.
     *
     * <p>The canvas draws it differently, and the row-editing endpoints refuse it: a view has no
     * rows of its own to update, and letting someone try produces a SQL error that explains
     * nothing about why.
     */
    private boolean view;
    private String name;
    private List<ColumnInfo> columns;
    private List<Map<String, Object>> rows;
}
