package com.dbviewer.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** Mirrors Go CreateTable request */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class CreateTableRequest {
    private String tableName;
    private List<ColumnDefinition> columns;
}
