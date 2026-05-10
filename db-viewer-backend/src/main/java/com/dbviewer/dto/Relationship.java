package com.dbviewer.dto;

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
}
