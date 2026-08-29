package com.dbviewer.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/** Mirrors Go InsertRowRequest */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class InsertRowRequest {
    private String tableName;
    private Map<String, Object> data;
}
