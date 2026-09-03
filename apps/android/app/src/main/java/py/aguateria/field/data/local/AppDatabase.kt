package py.aguateria.field.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(entities = [PendingOperationEntity::class], version = 1, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {
    abstract fun pendingDao(): PendingOperationDao
}
