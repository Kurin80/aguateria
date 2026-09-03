package py.aguateria.field.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface PendingOperationDao {
    @Query("SELECT * FROM pending_operations ORDER BY createdAt DESC")
    fun observeAll(): Flow<List<PendingOperationEntity>>

    @Query("SELECT * FROM pending_operations WHERE status IN ('LOCAL','PENDING_SYNC','ERROR')")
    suspend fun dueForSync(): List<PendingOperationEntity>

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(entity: PendingOperationEntity)

    @Query("UPDATE pending_operations SET status = :status, lastError = :error WHERE idempotencyKey = :key")
    suspend fun updateStatus(key: String, status: String, error: String?)
}
