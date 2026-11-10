package com.dbviewer.app.service;

import java.util.List;
import java.util.Map;

/**
 * Named versions of a file: save what it is now, look at an old one's schema, go back to it.
 *
 * <p>A snapshot is the file exported as a SQL script for the engine it runs on, kept in the
 * application database beside the owner row, plus the schema as it was read at the time (for
 * comparing without re-parsing SQL). Restoring replaces the file's tables with the script's.
 * Every method works on the workspace bound to the current request.
 *
 * @see com.dbviewer.app.service.impl.SnapshotServiceImpl
 */
public interface SnapshotService {

    /** This file's snapshots, newest first, without their scripts. */
    List<Map<String, Object>> list();

    /**
     * Saves the file as it is now.
     *
     * @throws IllegalArgumentException when the file already has the maximum number of
     *         snapshots, or is too large to keep one of
     */
    Map<String, Object> create(String name);

    /** The schema recorded with a snapshot: {@code tables} and {@code relationships}. */
    Map<String, Object> schema(long id);

    /**
     * Replaces the file's tables and rows with a snapshot's. If the snapshot cannot be run, the
     * file is put back as it was.
     */
    Map<String, Object> restore(long id);

    void delete(long id);

    /** Removes every snapshot of a workspace; called when the workspace itself is deleted. */
    void deleteAllFor(String workspaceId);
}
